import { attempt } from "./sliding-window.js";

export const rm1 = async (req, res, next) => {
    try {
        const ip = req.ip;

        const result = await attempt(`rate:${ip}`);

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