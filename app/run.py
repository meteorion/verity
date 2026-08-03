import asyncio
import sys

import uvicorn

if sys.platform == "win32":
    # psycopg3 requires SelectorEventLoop; Windows defaults to ProactorEventLoop.
    asyncio.set_event_loop_policy(asyncio.WindowsSelectorEventLoopPolicy())

if __name__ == "__main__":
    uvicorn.run("main:app", reload=True, host="0.0.0.0", port=8000)
