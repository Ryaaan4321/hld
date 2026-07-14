import express from 'express'
import { getUserById, updateUserWriteThrough } from '../controller.js/write-through.controller';

const writeRouter=express.Router();
writeRouter.get('/:id',getUserById)
writeRouter.patch('/:id',updateUserWriteThrough)
export default writeRouter