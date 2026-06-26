import { redis } from "./lib/rate-limiter.js";

const WINDOW_SECONDS = 60;
const LIMIT = 10;


const LUA_SCRIPT=`

`
export const rateMiddleware = async (req, res, next) => {
    try {
        const ip = req.ip;
        const startedAtStr = await redis.get(`rl-time-${ip}`);
        const startedAt = startedAtStr === null ? null : parseInt(startedAtStr, 10);
        const now = Date.now()
        const windowExpired = startedAt === null || (now - startedAt) / 1000 > WINDOW_SECONDS;
        if (windowExpired) {
            await redis.set(`rl-time-${ip}`, now.toString(), 'EX', WINDOW_SECONDS + 5);
            await redis.set(`rl-curr-${ip}`, 0, 'EX', WINDOW_SECONDS + 5);
        }
        const newCount = await redis.incr(`rl-curr-${ip}`);
        if (newCount > LIMIT) {
            return res.status(429).json({ msg: "rate limit exceeded" });
        }
        next();
    } catch (e) {
        next(e);
    }
};