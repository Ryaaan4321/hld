import express from 'express'
import { createUser, getAllUser,getAllUserMutex,getAllUserSWR,getUser } from '../controller.js/cacheaside.controller.js';

const router=express.Router();

router.post('/',createUser);
router.get('/',getAllUserSWR)
router.get('/:id',getUser);

export default router;