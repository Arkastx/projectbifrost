"""Main entry point for Project Bifrost."""
import asyncio
import json
import webbrowser
from pathlib import Path
import uvicorn
from loguru import logger

from src.config import load_config, setup_logging, STATE_CACHE_PATH
from src.udp_listener import CarrotBlenderListener
from src.server import app, broadcast_state
from src.models import apply_cached_state


async def main():
    """Run UDP listener and web server concurrently."""
    cfg = load_config()
    setup_logging(cfg.get("log_level", "INFO"))

    logger.info("Starting Project Bifrost")
    if STATE_CACHE_PATH.exists():
        try:
            cached = json.loads(STATE_CACHE_PATH.read_text(encoding="utf-8"))
            apply_cached_state(cached)
            logger.info("Loaded cached training state")
        except Exception as e:
            logger.error(f"Failed to load cached training state: {e}")

    # Initialize UDP listener
    listener = CarrotBlenderListener(
        host=cfg["udp_host"],
        port=cfg["udp_port"],
        max_buffer=cfg["max_buffer_size"],
    )

    # Callback to broadcast updates when data arrives
    def on_data(data, packet_type):
        asyncio.create_task(broadcast_state())

    listener.on_data = on_data
    listener.start()

    # Configure uvicorn
    config = uvicorn.Config(
        app,
        host=cfg["web_host"],
        port=cfg["web_port"],
        log_level="warning",
    )
    server = uvicorn.Server(config)

    # Open browser
    url = f"http://{cfg['web_host']}:{cfg['web_port']}"
    logger.info(f"Opening browser at {url}")
    webbrowser.open(url)

    # Run both concurrently
    try:
        await asyncio.gather(
            listener.listen(),
            server.serve(),
        )
    except KeyboardInterrupt:
        logger.info("Shutting down...")
    finally:
        listener.stop()


if __name__ == "__main__":
    asyncio.run(main())
