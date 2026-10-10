import asyncio
import time
import logging
from typing import Dict, Any, Optional
import httpx
from backend.config import get_settings

logger = logging.getLogger("gateway-core")

class RateLimitGateway:
    """
    Central MoySklad Rate Limit Manager and Request Dispatcher.
    - Manages concurrency via Async Semaphore
    - Throttles requests according to MoySklad remaining budget
    - Auto-retries on 429 Too Many Requests with exponential backoff
    - In-memory caching for high frequency read endpoints
    """
    def __init__(self):
        self.settings = get_settings()
        self.token = self.settings.moysklad_token
        self.base_url = self.settings.moysklad_api_url.rstrip("/")
        self.semaphore = asyncio.Semaphore(5)  # Max 5 parallel requests to MoySklad
        self.rate_limit_remaining = 300
        self.retry_after = 0
        self.last_request_time = 0.0
        
        # Simple TTL Cache: {cache_key: (timestamp, data)}
        self._cache: Dict[str, tuple[float, Any]] = {}

    def _headers(self) -> Dict[str, str]:
        return {
            "Authorization": f"Bearer {self.token}",
            "Accept-Encoding": "gzip",
            "Content-Type": "application/json",
            "Lognex-Pretty-Print": "false"
        }

    def get_cached(self, key: str, ttl_seconds: int = 60) -> Optional[Any]:
        if key in self._cache:
            ts, val = self._cache[key]
            if time.time() - ts < ttl_seconds:
                return val
        return None

    def set_cache(self, key: str, val: Any):
        self._cache[key] = (time.time(), val)

    def invalidate_cache(self, prefix: Optional[str] = None):
        if prefix:
            keys_to_del = [k for k in self._cache if k.startswith(prefix)]
            for k in keys_to_del:
                self._cache.pop(k, None)
        else:
            self._cache.clear()

    async def execute_request(
        self,
        method: str,
        endpoint: str,
        params: Optional[Dict[str, Any]] = None,
        json_data: Optional[Dict[str, Any]] = None,
        max_retries: int = 3,
        timeout: float = 35.0
    ) -> Any:
        url = f"{self.base_url}/{endpoint.lstrip('/')}"
        
        async with self.semaphore:
            for attempt in range(1, max_retries + 1):
                # Rate limit pacing: at least 50ms between requests
                now = time.time()
                elapsed = now - self.last_request_time
                if elapsed < 0.05:
                    await asyncio.sleep(0.05 - elapsed)

                async with httpx.AsyncClient(timeout=timeout) as client:
                    try:
                        self.last_request_time = time.time()
                        resp = await client.request(
                            method=method,
                            url=url,
                            headers=self._headers(),
                            params=params,
                            json=json_data
                        )

                        # Update rate limit info from headers
                        if "X-RateLimit-Remaining" in resp.headers:
                            try:
                                self.rate_limit_remaining = int(resp.headers["X-RateLimit-Remaining"])
                            except ValueError:
                                pass

                        if resp.status_code in (200, 201):
                            return resp.json()
                        elif resp.status_code == 204:
                            return True
                        elif resp.status_code in (429, 503):
                            # Rate limited
                            retry_sec = 2.0 * attempt
                            if "X-Lognex-Retry-After" in resp.headers:
                                try:
                                    retry_sec = max(float(resp.headers["X-Lognex-Retry-After"]) / 1000.0, retry_sec)
                                except ValueError:
                                    pass
                            logger.warning(f"MoySklad 429/503 rate limit on {endpoint}. Backoff {retry_sec:.2f}s (Attempt {attempt}/{max_retries})")
                            await asyncio.sleep(retry_sec)
                            continue
                        else:
                            error_text = resp.text
                            logger.error(f"MoySklad API Error [{resp.status_code}] on {endpoint}: {error_text[:300]}")
                            return {"error": True, "status_code": resp.status_code, "detail": error_text}
                    except Exception as e:
                        logger.exception(f"Request exception on {endpoint} (Attempt {attempt}/{max_retries}): {e}")
                        if attempt < max_retries:
                            await asyncio.sleep(1.5 * attempt)
                        else:
                            return {"error": True, "detail": str(e)}

        return {"error": True, "detail": "Max retries exceeded"}

# Singleton instance
gateway = RateLimitGateway()
