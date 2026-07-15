import logger from "../lib/logger.js";
import redis from "../lib/redis.js";
import pool from "../lib/db.js";

export async function incrementViewCount(req, res) {
    const { postId } = req.params;
    await redis.incr(`views:${postId}`);
    return res.status(200).json({ msg: 'view recorded' });
}
async function flushViewCountsToDb() {
    const keys = await redis.keys('views:*');
    for (const key of keys) {
        const postId = key.split(':')[1];
        const count = await redis.get(key);
        await pool.query(
            'UPDATE posts SET view_count = view_count + $1 WHERE id = $2',
            [count, postId]
        );
        await redis.del(key);
    }
    logger.info({ source: 'flush_job', keysFlushed: keys.length }, 'flushed view counts to db');
}

setInterval(flushViewCountsToDb, 30000); // every 30 seconds