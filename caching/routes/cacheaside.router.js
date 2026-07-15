import express from 'express'
import { getAllUserSWR,getUser,createUser,getAllUserMutex } from '../controller/cacheaside.controller.js';
const router=express.Router();

router.post('/',createUser);
router.get('/',getAllUserSWR)
router.get('/:id',getUser);

export default router;