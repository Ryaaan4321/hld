import logger from "../lib/logger";
import redis from "../lib/redis";
import pool from "../lib/db";

export async function createUserWriteThrough(req, res) {
    const reqId = req.id;
    try {
        const { name, email, password } = req.body;
        const dbRes = await pool.query(
            'INSERT INTO USERS (name, email, password) VALUES($1,$2,$3) RETURNING id, name, email',
            [name, email, password]
        );
        const newUser = dbRes.rows[0];
        /* Write-through: update cache with the fresh full list, not just delete */
        const allUsersRes = await pool.query('SELECT * FROM users');
        await redis.set('allUser', JSON.stringify(allUsersRes.rows), 'EX', 60);
        logger.info({ reqId, source: 'write_through' }, 'db and cache both updated on write');
        return res.status(200).json({ user: newUser });
    } catch (e) {
        logger.error({ reqId, err: e.message }, 'createUserWriteThrough failed');
        return res.status(500).json({ msg: e.message });
    }
}
export async function getUserById(req, res) {
    const reqId = req.id;
    const { id } = req.params;
    const cacheKey = `user:${id}`;
    try {
        const cached = await redis.get(cacheKey);
        if (cached) {
            logger.info({ reqId, source: 'redis' }, 'cache hit');
            return res.status(200).json({ user: JSON.parse(cached) });
        }
        const dbRes = await pool.query('SELECT id, name, email FROM users WHERE id = $1', [id]);
        if (dbRes.rows.length === 0) {
            return res.status(404).json({ msg: 'user not found' });
        }
        const user = dbRes.rows[0];
        await redis.set(cacheKey, JSON.stringify(user), 'EX', 60);
        logger.info({ reqId, source: 'db' }, 'cache populated');
        return res.status(200).json({ user });
    } catch (e) {
        logger.error({ reqId, err: e.message }, 'getUserById failed');
        return res.status(500).json({ msg: e.message });
    }
}
export async function updateUserWriteThrough(req, res) {
    const reqId = req.id;
    const { id } = req.params;
    const { name, email } = req.body;
    try {
        const dbRes = await pool.query(
            'UPDATE users SET name = $1, email = $2 WHERE id = $3 RETURNING id, name, email',
            [name, email, id]
        );
        if (dbRes.rows.length === 0) {
            return res.status(404).json({ msg: 'user not found' });
        }
        const updatedUser = dbRes.rows[0];
        /* Write-through: we ALREADY have the fresh row from RETURNING — no re-query needed */
        await redis.set(`user:${id}`, JSON.stringify(updatedUser), 'EX', 60);
        logger.info({ reqId, source: 'write_through' }, 'db and cache both updated, no re-query');
        return res.status(200).json({ user: updatedUser });
    } catch (e) {
        logger.error({ reqId, err: e.message }, 'updateUserWriteThrough failed');
        return res.status(500).json({ msg: e.message });
    }
}