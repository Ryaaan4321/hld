import express from 'express';
import pool from '../lib/db.js'
import redis from '../lib/redis.js';
import logger from '../lib/logger.js';
import { randomUUID } from 'crypto';
function sleep(ms) {
    return new Promise(res => setTimeout(res, ms));
}
export async function createUser(req, res) {
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
        return res.status(500).json({ msg: e });
    }
}
export async function getAllUser(req, res) {
    const reqId = randomUUID().slice(0, 8);
    const start = process.hrtime.bigint();
    try {
        const cachedData = await redis.get('allUser');
        let result;
        let source;
        if (cachedData) {
            source = 'cache'
            result = JSON.parse(cachedData);
        } else {
            const dbRes = await pool.query('SELECT * FROM users');
            result = dbRes.rows;
            await redis.set('allUser', JSON.stringify(result), 'EX', 30);
            source = 'db'
        }
        const durationMs = Number(process.hrtime.bigint() - start) / 1e6;
        logger.info({
            reqId,
            route: '/allusers',
            source,
            durationMs: durationMs.toFixed(2),
            rowCount: result.length
        }, 'request completed');
        return res.status(200).json({ users: result });
    } catch (e) {
        console.log(e);
        logger.error({
            reqId,
            route: '/allusers',
            durationMs: durationMs.toFixed(2),
            error: e.message
        }, 'request failed');
        return res.status(500).json({ msg: e.message });
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
                await redis.set('allUser', JSON.stringify(result), 'EX', 30);
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