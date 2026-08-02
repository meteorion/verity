"""Ragas-based evaluation for RAG retrieval and generation quality.

Computes the following metrics using the Ragas framework:

Retrieval metrics:
  - context_precision  — whether retrieved contexts are relevant (requires ground_truth)
  - context_recall     — whether all relevant info is retrieved (requires ground_truth)
  - context_relevancy  — whether contexts are relevant to the query

Generation metrics (answer is auto-generated from contexts if not supplied):
  - faithfulness        — whether the answer is faithful to contexts
  - answer_relevancy    — whether the answer is relevant to the question
  - answer_correctness  — accuracy vs ground truth (requires ground_truth)
  - answer_correctness  — factual accuracy + semantic similarity vs ground truth (composite)
"""
import asyncio
import json
import logging
import os
from pathlib import Path

logger = logging.getLogger(__name__)

_SETTINGS_PATH = Path(os.getenv("SETTINGS_PATH", "/data/app_settings.json"))


def _load_settings() -> dict:
    try:
        return json.loads(_SETTINGS_PATH.read_text(encoding="utf-8"))
    except (FileNotFoundError, json.JSONDecodeError):
        return {}


def _s(field: str, env_var: str, default: str = "") -> str:
    """Return first truthy value: settings file → env var → default."""
    settings = _load_settings()
    return settings.get(field) or os.getenv(env_var, default)

# Sentinel: None = not yet tried, False = tried and failed permanently
_EMBEDDINGS_UNAVAILABLE = False


def _import_context_relevancy():
    """Handle renamed class across Ragas versions."""
    try:
        from ragas.metrics import LLMContextRelevancy
        return LLMContextRelevancy
    except ImportError:
        pass
    try:
        from ragas.metrics import ContextRelevance
        return ContextRelevance
    except ImportError:
        pass
    raise ImportError("Cannot import context relevancy metric from ragas — check ragas version")


class RagasEvaluator:
    """Evaluate RAG quality using the Ragas framework."""

    def __init__(self):
        self._llm = None
        self._embeddings = None
        self._embeddings_failed = False  # permanent failure flag; avoid retrying every call

    def _api_key(self) -> str:
        return (
            _s("llm_api_key", "LLM_API_KEY")
            or os.getenv("QWEN_API_KEY", "")
            or os.getenv("OPENAI_API_KEY", "")
        )

    def _emb_api_key(self) -> str:
        return (
            _s("embedding_api_key", "EMBEDDING_API_KEY")
            or self._api_key()
        )

    def _base_url(self) -> str:
        return _s(
            "llm_api_base", "LLM_API_BASE",
            "https://dashscope.aliyuncs.com/compatible-mode/v1",
        )

    def _emb_base_url(self) -> str:
        return (
            _s("embedding_api_base", "EMBEDDING_API_BASE")
            or self._base_url()
        )

    async def _ensure_llm(self):
        if self._llm is not None:
            return self._llm
        api_key = self._api_key()
        if not api_key:
            logger.error(
                "Ragas LLM init failed: no API key found. "
                "Set LLM_API_KEY (or QWEN_API_KEY / OPENAI_API_KEY) in .env"
            )
            return None
        try:
            from ragas.llms import LangchainLLMWrapper
            from langchain_openai import ChatOpenAI

            # RAGAS_LLM_MODEL lets you use a faster/cheaper model just for metric evaluation
            ragas_model = _s("ragas_llm_model", "RAGAS_LLM_MODEL") or _s("llm_model", "LLM_MODEL", "qwen-plus")
            llm = ChatOpenAI(
                model=ragas_model,
                api_key=api_key,
                base_url=self._base_url(),
                temperature=0,
            )
            self._llm = LangchainLLMWrapper(llm)
            logger.info("Ragas LLM initialized: %s @ %s", ragas_model, self._base_url())
            return self._llm
        except Exception:
            logger.exception("Failed to initialize Ragas LLM")
            return None

    async def _ensure_embeddings(self):
        if self._embeddings is not None:
            return self._embeddings
        if self._embeddings_failed:
            return None
        api_key = self._emb_api_key()
        if not api_key:
            self._embeddings_failed = True
            logger.error("Ragas embeddings init failed: no API key found")
            return None
        try:
            from langchain_openai import OpenAIEmbeddings

            emb_model = _s("embedding_model", "EMBEDDING_MODEL", "text-embedding-v3")
            _base = OpenAIEmbeddings(
                model=emb_model,
                api_key=api_key,
                base_url=self._emb_base_url(),
                # Dashscope rejects tiktoken integer-array input; keep plain strings.
                check_embedding_ctx_length=False,
            )

            # Dashscope rejects batched embedding calls with 400.
            # Plain duck-typed adapter — no ragas/Pydantic inheritance, no instantiation issues.
            # _base is captured in closure; ragas calls embed_text / embed_texts at runtime.
            async def _embed_one(text: str):
                return (await _base.aembed_documents([text]))[0]

            class _DashscopeEmbeddings:
                async def embed_text(self2, text: str):
                    return await _embed_one(text)

                async def aembed_query(self2, text: str):
                    return await _embed_one(text)

                async def aembed_documents(self2, texts):
                    results = []
                    for t in texts:
                        results.append(await _embed_one(t))
                    return results

                async def embed_texts(self2, texts):
                    results = []
                    for t in texts:
                        results.append(await _embed_one(t))
                    return results

                def embed_query(self2, text: str):
                    import asyncio
                    import concurrent.futures
                    with concurrent.futures.ThreadPoolExecutor(max_workers=1) as pool:
                        return pool.submit(asyncio.run, _embed_one(text)).result()

                def embed_documents(self2, texts):
                    import asyncio
                    import concurrent.futures

                    async def _all():
                        results = []
                        for t in texts:
                            results.append(await _embed_one(t))
                        return results

                    with concurrent.futures.ThreadPoolExecutor(max_workers=1) as pool:
                        return pool.submit(asyncio.run, _all()).result()

            self._embeddings = _DashscopeEmbeddings()
            logger.info("Ragas embeddings initialized: %s", emb_model)
            return self._embeddings
        except Exception:
            self._embeddings_failed = True
            logger.exception(
                "Failed to initialize Ragas embeddings — "
                "answer_relevancy and answer_correctness will be skipped"
            )
            return None

    async def generate_answer(self, query: str, contexts: list[str], temperature: float = 0.0) -> str:
        """Generate a concise answer from retrieved contexts using the configured LLM."""
        from langchain_core.messages import HumanMessage, SystemMessage
        from langchain_openai import ChatOpenAI

        model = _s("llm_model", "LLM_MODEL", "qwen-plus")
        knowledge = "\n\n".join(f"[{i+1}] {c}" for i, c in enumerate(contexts[:5]))
        try:
            llm = ChatOpenAI(
                model=model,
                api_key=self._api_key(),
                base_url=self._base_url(),
                max_tokens=400,
                temperature=temperature,
            )
            response = await llm.ainvoke([
                SystemMessage(content="你是问答助手，请依据提供的知识简洁回答问题，不要编造。"),
                HumanMessage(content=f"<知识>\n{knowledge}\n</知识>\n\n{query}"),
            ])
            return str(response.content)
        except Exception:
            logger.exception("generate_answer failed for query [%s...]", query[:80])
            return ""

    async def evaluate_single(
        self,
        query: str,
        contexts: list[str],
        answer: str = "",
        ground_truth: str = "",
        enabled_metrics: set | None = None,
    ) -> dict[str, float]:
        """Evaluate a single query-response pair.

        Returns dict of metric_name -> score (0.0–1.0).
        Missing metrics are omitted (not set to 0) so callers can distinguish
        'score is 0' from 'metric was not computed'.
        """
        scores: dict[str, float] = {}

        if not contexts:
            logger.warning("evaluate_single: no contexts provided — returning zero retrieval scores")
            return {"context_relevancy": 0.0, "context_precision": 0.0, "context_recall": 0.0}

        llm = await self._ensure_llm()
        if llm is None:
            logger.error("evaluate_single: LLM unavailable, cannot compute any Ragas metrics")
            return scores

        if not answer:
            answer = await self.generate_answer(query, contexts)
            if not answer:
                logger.warning(
                    "evaluate_single: answer generation failed — "
                    "faithfulness / answer_relevancy will be skipped"
                )

        # Run retrieval and generation metrics concurrently
        gen_task = (
            self._compute_generation_metrics(query, contexts, answer, ground_truth, llm, scores, enabled_metrics)
            if answer else asyncio.sleep(0)
        )
        await asyncio.gather(
            self._compute_retrieval_metrics(query, contexts, ground_truth, llm, scores, enabled_metrics),
            gen_task,
        )

        computed = list(scores.keys())
        skipped = [
            k for k in [
                "context_relevancy", "faithfulness", "answer_relevancy",
                "context_recall", "answer_correctness", "context_precision",
            ]
            if k not in scores
        ]
        logger.info(
            "Ragas eval done — computed: %s | skipped: %s",
            computed or "none", skipped or "none",
        )
        return scores

    async def _compute_retrieval_metrics(
        self,
        query: str,
        contexts: list[str],
        ground_truth: str,
        llm,
        scores: dict[str, float],
        enabled_metrics: set | None = None,
    ):
        from ragas.metrics import LLMContextPrecisionWithReference, LLMContextRecall
        from ragas import SingleTurnSample

        def _want(key: str) -> bool:
            return enabled_metrics is None or key in enabled_metrics

        async def _precision():
            if not _want("context_precision") or not ground_truth:
                return
            try:
                sample = SingleTurnSample(
                    user_input=query, response="",
                    retrieved_contexts=contexts, reference=ground_truth,
                )
                result = await LLMContextPrecisionWithReference(llm=llm).single_turn_ascore(sample)
                scores["context_precision"] = round(float(result), 4)
            except Exception:
                logger.exception("context_precision failed")

        async def _recall():
            if not _want("context_recall") or not ground_truth:
                return
            try:
                sample = SingleTurnSample(
                    user_input=query, response="",
                    retrieved_contexts=contexts, reference=ground_truth,
                )
                result = await LLMContextRecall(llm=llm).single_turn_ascore(sample)
                scores["context_recall"] = round(float(result), 4)
            except Exception:
                logger.exception("context_recall failed")

        async def _relevancy():
            if not _want("context_relevancy"):
                return
            try:
                ContextRelevancy = _import_context_relevancy()
                sample = SingleTurnSample(
                    user_input=query, response="", retrieved_contexts=contexts,
                )
                result = await ContextRelevancy(llm=llm).single_turn_ascore(sample)
                scores["context_relevancy"] = round(float(result), 4)
            except Exception:
                logger.exception("context_relevancy failed")

        if not ground_truth:
            logger.debug("context_precision / context_recall skipped: no ground_truth")
        await asyncio.gather(_precision(), _recall(), _relevancy())

    async def _compute_generation_metrics(
        self,
        query: str,
        contexts: list[str],
        answer: str,
        ground_truth: str,
        llm,
        scores: dict[str, float],
        enabled_metrics: set | None = None,
    ):
        from ragas.metrics import Faithfulness, ResponseRelevancy, AnswerCorrectness, SemanticSimilarity
        from ragas import SingleTurnSample

        def _want(key: str) -> bool:
            return enabled_metrics is None or key in enabled_metrics

        # Initialize embeddings once before spawning parallel tasks
        need_emb = _want("answer_relevancy") or _want("answer_correctness")
        emb = await self._ensure_embeddings() if need_emb else None

        async def _faithfulness():
            if not _want("faithfulness"):
                return
            try:
                sample = SingleTurnSample(
                    user_input=query, response=answer, retrieved_contexts=contexts,
                )
                result = await Faithfulness(llm=llm).single_turn_ascore(sample)
                scores["faithfulness"] = round(float(result), 4)
            except Exception:
                logger.exception("faithfulness failed")

        async def _answer_relevancy():
            if not _want("answer_relevancy"):
                return
            if not emb:
                logger.warning("answer_relevancy skipped: embeddings unavailable")
                return
            try:
                sample = SingleTurnSample(
                    user_input=query, response=answer, retrieved_contexts=contexts,
                )
                result = await ResponseRelevancy(llm=llm, embeddings=emb).single_turn_ascore(sample)
                scores["answer_relevancy"] = round(float(result), 4)
            except Exception:
                logger.exception("answer_relevancy failed")

        async def _answer_correctness():
            if not _want("answer_correctness") or not ground_truth:
                return
            if not emb:
                logger.warning("answer_correctness skipped: embeddings unavailable")
                return
            try:
                sim_metric = SemanticSimilarity(embeddings=emb)
                correctness_metric = AnswerCorrectness(llm=llm)
                correctness_metric.answer_similarity = sim_metric
                sample = SingleTurnSample(
                    user_input=query, response=answer, reference=ground_truth,
                )
                result = await correctness_metric.single_turn_ascore(sample)
                scores["answer_correctness"] = round(float(result), 4)
            except Exception:
                logger.exception("answer_correctness failed")

        if not ground_truth:
            logger.debug("answer_correctness skipped: no ground_truth")
        await asyncio.gather(_faithfulness(), _answer_relevancy(), _answer_correctness())

    async def evaluate_batch(self, samples: list[dict]) -> list[dict]:
        results = []
        for sample in samples:
            scores = await self.evaluate_single(
                query=sample.get("query", ""),
                contexts=sample.get("contexts", []),
                answer=sample.get("answer", ""),
                ground_truth=sample.get("ground_truth", ""),
            )
            results.append({**sample, "scores": scores})
        return results

    async def compute_aggregate_metrics(self, results: list[dict]) -> dict:
        metric_keys = [
            "context_relevancy", "faithfulness", "answer_relevancy",
            "context_recall", "answer_correctness", "context_precision",
        ]
        aggregates: dict[str, float] = {}
        for key in metric_keys:
            values = [r["scores"][key] for r in results if key in r.get("scores", {})]
            if values:
                aggregates[key] = round(sum(values) / len(values), 4)
        return aggregates


_evaluator: RagasEvaluator | None = None


def get_evaluator() -> RagasEvaluator:
    global _evaluator
    if _evaluator is None:
        _evaluator = RagasEvaluator()
    return _evaluator


def reset_evaluator() -> None:
    """Discard the singleton so the next call re-initialises with current settings."""
    global _evaluator
    _evaluator = None
    logger.info("RagasEvaluator reset — will reinitialise on next use")
