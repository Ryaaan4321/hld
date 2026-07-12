import pg from 'pg'
import dotenv from 'dotenv'
dotenv.config();
const {Pool}=pg;
const pool=new Pool({
    host:process.env.HOST,
    port:process.env.PORT,
    user:process.env.DB_USER,
    password:process.env.PASSWORD,
    database:process.env.NAME
})

export default pool;