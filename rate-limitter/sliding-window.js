import { randomUUID } from "crypto";
import { redis } from "./lib/rate-limiter.js";

const LUA_SCRIPT = `
local key = KEYS[1]

local maxRequests = tonumber(ARGV[1])
local windowSeconds = tonumber(ARGV[2])
local now = tonumber(ARGV[3])
local member = ARGV[4]

-- Remove requests outside the sliding window
local windowStart = now - (windowSeconds * 1000)
redis.call('ZREMRANGEBYSCORE', key, 0, windowStart)

-- Count requests remaining in the window
local count = redis.call('ZCARD', key)

if count < maxRequests then
    redis.call('ZADD', key, now, member)
    redis.call('EXPIRE', key, windowSeconds)

    return {1, maxRequests - count - 1}
else
    local oldest = redis.call('ZRANGE', key, 0, 0, 'WITHSCORES')

    local retryAfterMs = windowSeconds * 1000

    if #oldest >= 2 then
        retryAfterMs = tonumber(oldest[2]) + (windowSeconds * 1000) - now
    end

    return {0, 0, retryAfterMs}
end
`;

const DEFAULT_CONFIG = {
    maxRequests: 300,
    windowSeconds: 60,
};
export async function attempt(key, config = DEFAULT_CONFIG) {
    const { maxRequests, windowSeconds } = config;
    const now = Date.now();
    const member = `${now}-${randomUUID()}`;

    const result = await redis.eval(
        LUA_SCRIPT,
        1,                  /* number of KEYS */
        key,                /* KEYS[1] */
        maxRequests,        /* ARGV[1] */
        windowSeconds,      /* ARGV[2] */
        now,                /* ARGV[3] */
        member              /* ARGV[4] */
    );
    const allowed = result[0] === 1;
    const remaining = result[1];
    const retryAfterMs = result[2];

    return {
        allowed,
        remaining,
        limit: maxRequests,
        retryAfter: allowed ? null : retryAfterMs / 1000,
    };
}