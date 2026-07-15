import express from 'express'
import { updateUserWriteThrough,getUserById } from '../controller/write-through.controller.js';
const writeRouter=express.Router();
writeRouter.get('/:id',getUserById)
writeRouter.put('/update/:id',updateUserWriteThrough)
export default writeRouter