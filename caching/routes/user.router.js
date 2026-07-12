import express from 'express'
import { createUser, getAllUser,getUser } from '../controller.js/user.controller.js';

const router=express.Router();

router.post('/',createUser);
router.get('/',getAllUser)
router.get('/:id',getUser);

export default router;