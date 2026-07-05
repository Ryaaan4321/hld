import { sliding_window_counter } from "./sliding-window.counter.js";
const DEFAULT_CONFIG = {
    maxRequests: 100,
    windowSeconds: 60,
};
export const rm2 = async (req, res, next) => {
    console.log("middleware got calledd");
    try {
        const ip = req.ip;

        const result = await sliding_window_counter(`rate:${ip}`,DEFAULT_CONFIG);
        console.log("result == ",result);
        if (!result.allowed) {
            return res.status(429).json({
                message: "Rate limit exceeded",
                retryAfter: result.retryAfter,
                remaining: result.remaining,
                limit: result.limit,
            });
        }

        next();
    } catch (err) {
        next(err);
    }
};