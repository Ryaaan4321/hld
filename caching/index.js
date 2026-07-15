import express from 'express'
import dotenv from 'dotenv'
dotenv.config();
import router from './routes/cacheaside.router.js';
import writeRouter from './routes/write-through.router.js';
const app=express();
app.use(express.json())
app.use('/api',router);
app.use('/api/w1',writeRouter);
app.listen(3000,()=>{
    console.log("listening listeninggg");
})