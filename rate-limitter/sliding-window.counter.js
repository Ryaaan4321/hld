import { redis } from "./lib/rate-limiter.js"
const LUA_SCRIPT = `
local current_key = KEYS[1]
local previous_key = KEYS[2]
local max_requests = tonumber(ARGV[1])
local window_seconds = tonumber(ARGV[2])
local elapsed = tonumber(ARGV[3])

local prev_count = tonumber(redis.call('GET', previous_key) or '0') or 0
local current_count = tonumber(redis.call('GET', current_key) or '0') or 0

local weighted_prev = prev_count * (1 - elapsed)
local estimated = weighted_prev + current_count

if estimated >= max_requests then
  return { 0, 0, math.floor(current_count) }
end

local new_count = redis.call('INCR', current_key)

if new_count == 1 then
  redis.call('EXPIRE', current_key, window_seconds * 2)
end

local new_estimate = weighted_prev + new_count
local remaining = math.max(0, math.floor(max_requests - new_estimate))

return { 1, remaining, new_count }
`;



export async function sliding_window_counter(key, config) {
    const { maxRequests, windowSeconds } = config;
    const now = Math.floor(Date.now() / 1000);
    const currentWindow = Math.floor(now / windowSeconds);
    const previousWindow = currentWindow - 1;
    const currentKey = `{${key}}:${currentWindow}`;
    const previousKey = `{${key}}:${previousWindow}`;
    const elapsed = (now % windowSeconds) / windowSeconds;
    await redis.flushall();
    console.log({
        currentKey,
        previousKey,
        current: await redis.get(currentKey),
        previous: await redis.get(previousKey),
    });
    const result = await redis.eval(
        LUA_SCRIPT,
        2,
        currentKey,
        previousKey,
        maxRequests.toString(),
        windowSeconds.toString(),
        elapsed.toString()
    );
    const hget=await redis.call('HGETALL',currentKey)
    console.log("h get == ",hget);
    const allowed = result[0] === 1;
    const remaining = result[1];

    let retryAfter = 0;
    if (!allowed) {
        retryAfter = Math.max(1, Math.ceil(windowSeconds * (1 - elapsed)));
    }
    return {
        allowed,
        remaining,
        limit: maxRequests,
        retryAfter,
    };
}