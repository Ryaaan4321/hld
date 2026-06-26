import Redis from "ioredis";
import dotenv from 'dotenv'
dotenv.config();

console.log("url from the env == ",process.env.REDIS_URL)
export const redis=new Redis(process.env.REDIS_URL);