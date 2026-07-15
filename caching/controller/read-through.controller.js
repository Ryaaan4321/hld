import logger from "../lib/logger.js";
import redis from "../lib/redis.js";
import pool from "../lib/db.js";

async function cacheGet(key, fetchFn, ttl = 60) {
    const cached = await redis.get(key);
    if (cached) return JSON.parse(cached);
    const fresh = await fetchFn();
    await redis.set(key, JSON.stringify(fresh), 'EX', ttl);
    return fresh;
}
async function getUserById(id) {
    return await cacheGet(`user:${id}`, async () => {
        const dbRes = await pool.query('SELECT * FROM users WHERE id=$1', [id]);
        return dbRes.rows[0];
    });
}
async function getUserByEmail(email) {
    return await cacheGet(`user:email:${email}`, async () => {
        const dbRes = await pool.query('SELECT * FROM users WHERE email=$1', [email]);
        return dbRes.rows[0];
    });
}