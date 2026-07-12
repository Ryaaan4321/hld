import express from 'express'
import dotenv from 'dotenv'
dotenv.config();
import router from './routes/user.router.js';
const app=express();
app.use(express.json())
app.use('/api',router);
app.listen(3000,()=>{
    console.log("listening listeninggg");
})