import express from 'express';
import pool from '../lib/db.js'
import redis from '../lib/redis.js';
import logger from '../lib/logger.js';
import { randomUUID } from 'crypto';
/* can you do one thing fire the post request and the get request with the 
 close to none window and than check the latency of all this controllers*/
function sleep(ms) {
    return new Promise(res => setTimeout(res, ms));
}
function jitteredTTL(baseSeconds, jitterSeconds) {
    const offset = Math.floor(Math.random() * (2 * jitterSeconds + 1)) - jitterSeconds;
    return baseSeconds + offset;
}
/*
Since we have only have one key (allUser), jitter won't visibly 
change our stampede behavior in this project — this technique's
value only shows up when we have many hot keys expiring together,
which isn't our current setup. So the correct way to think about this 
exercise:  (the offset math, the Redis TTL actually varying), not that it "
fixes" anything observable in our single-key project. our lock-based 
approach from before is what's actually doing the real stampede protection here.
*/

export async function createUser(req, res) {
    const client = await pool.connect()
    try {
        const name = req.body.name;
        const email = req.body.email
        const password = req.body.password;
        const result = await pool.query('INSERT INTO USERS (name,email,password) VALUES($1,$2,$3) RETURNING id, name, email',
            [name, email, password]
        );
        await redis.del("allUser");
        return res.status(200).json({ users: result.rows[0] });
    }
    catch (e) {
        await client.release()
        return res.status(500).json({ msg: e });
    }
}
export async function getAllUser(req, res) {
    const client = await pool.connect()
    const reqId = randomUUID().slice(0, 8);
    const start = process.hrtime.bigint();
    try {
        const cachedData = await redis.get("allUser");
        let result;
        let source;
        if (cachedData) {
            source = "cache";
            result = JSON.parse(cachedData);
        } else {
            const dbRes = await client.query("SELECT * FROM users");
            result = dbRes.rows;
            await redis.set("allUser", JSON.stringify(result), "EX", 30);
            source = "db";
        }
        const durationMs = Number(process.hrtime.bigint() - start) / 1e6;
        logger.info({
            reqId,
            route: "/allusers",
            source,
            durationMs: durationMs.toFixed(2),
            rowCount: result.length,
        });
        return res.status(200).json({ users: result });
    } catch (e) {
        const durationMs = Number(process.hrtime.bigint() - start) / 1e6;
        logger.error({
            reqId,
            route: "/allusers",
            durationMs: durationMs.toFixed(2),
            error: e.message,
        });
        return res.status(500).json({ msg: e.message });
    } finally {
        await client.release()
    }
}

export async function getUser(req, res) {
    try {
        const { id } = req.params;
        const result = await pool.query(`select * from users where id=$1`, [id]);
        if (result.rows.length == 0) {
            return res.status(404).json({ msg: "user not found" })
        }
        return res.status(200).json({ user: result.rows[0] });
    } catch (e) {
        return res.status(500).json({ msg: e.message });
    }
}

export async function getAllUserMutex(req, res) {
    const reqId = req.id;
    const client = await pool.connect()
    try {
        let cachedData = await redis.get('allUser');
        if (cachedData) {
            logger.info({ reqId, source: 'redis' }, 'cache hit');
            return res.status(200).json({ users: JSON.parse(cachedData) });
        }
        const lockKey = 'lock:allUser';
        const lockAcquired = await redis.set(lockKey, '1', 'NX', 'EX', 5);
        if (lockAcquired) {
            logger.info({ reqId, source: 'lock_acquired' }, 'acquired lock, querying db');
            try {
                const start = Date.now();
                const dbRes = await pool.query('SELECT * FROM users');
                const durationMs = Date.now() - start;
                const result = dbRes.rows;
                await redis.set('allUser', JSON.stringify(result), 'EX', 60);
                logger.info(
                    { reqId, source: 'db', durationMs, rowCount: result.length },
                    'db query completed, cache repopulated'
                );
                return res.status(200).json({ users: result });
            } finally {
                await redis.del(lockKey);
                logger.info({ reqId, source: 'lock_released' }, 'lock released');
            }
        } else {
            logger.info({ reqId, source: 'lock_wait' }, 'lock held by another request, waiting');
            for (let i = 0; i < 5; i++) {
                await sleep(100);
                cachedData = await redis.get('allUser');
                if (cachedData) {
                    logger.info({ reqId, source: 'redis_after_wait' }, 'got cache after waiting');
                    return res.status(200).json({ users: JSON.parse(cachedData) });
                }
            }
            logger.warn({ reqId, source: 'fallback_db' }, 'gave up waiting on lock, querying db directly');
            const start = Date.now();
            const dbRes = await pool.query('SELECT * FROM users');
            const durationMs = Date.now() - start;
            logger.info(
                { reqId, source: 'db_fallback', durationMs, rowCount: dbRes.rows.length },
                'fallback db query completed'
            );
            return res.status(200).json({ users: dbRes.rows });
        }
    } catch (e) {
        logger.error({ reqId, err: e.message }, 'getAllUserMutex failed');
        return res.status(500).json({ msg: e.message });
    }
}
const SOFT_TTL_SECONDS = 30;   // data considered stale after this
const HARD_TTL_SECONDS = 60;  // data actually deleted after this
export async function getAllUserSWR(req, res) {
    const reqId = req.id;
    try {
        const cachedRaw = await redis.get('allUser');
        if (cachedRaw) {
            const cached = JSON.parse(cachedRaw);
            const ageSeconds = (Date.now() - cached.cachedAt) / 1000;
            if (ageSeconds < SOFT_TTL_SECONDS) {
                logger.info({ reqId, source: 'redis_fresh' }, 'cache hit, fresh');
                return res.status(200).json({ users: cached.data });
            }
            /* Stale but still within hard TTL — serve immediately, refresh in background */
            logger.info({ reqId, source: 'redis_stale' }, 'cache hit, stale — serving anyway, triggering refresh');
            res.status(200).json({ users: cached.data });
            triggerBackgroundRefresh(reqId); /* fire and forget, no await */
            return;
        }
        logger.info({ reqId, source: 'true_miss' }, 'no cached data at all, blocking on db');
        const result = await refreshCache(reqId);
        return res.status(200).json({ users: result });
    } catch (e) {
        logger.error({ reqId, err: e.message }, 'getAllUserSWR failed');
        return res.status(500).json({ msg: e.message });
    }
}
async function refreshCache(reqId) {
    const start = Date.now();
    const dbRes = await pool.query('SELECT * FROM users');
    const durationMs = Date.now() - start;
    const result = dbRes.rows;
    const payload = { data: result, cachedAt: Date.now() };
    const ttl = jitteredTTL(HARD_TTL_SECONDS, 20);
    await redis.set('allUser', JSON.stringify(payload), 'EX', ttl);
    logger.info({ reqId, source: 'db', durationMs, rowCount: result.length, ttl }, 'cache refreshed');
    return result;
}
async function triggerBackgroundRefresh(reqId) {
    const lockKey = 'refreshing:allUser';
    const lockAcquired = await redis.set(lockKey, '1', 'NX', 'EX', 10);
    if (!lockAcquired) {
        logger.info({ reqId, source: 'refresh_already_in_flight' }, 'someone else already refreshing, skipping');
        return;
    }
    try {
        await refreshCache(reqId);
    } catch (e) {
        logger.error({ reqId, err: e.message }, 'background refresh failed');
    } finally {
        await redis.del(lockKey);
    }
}