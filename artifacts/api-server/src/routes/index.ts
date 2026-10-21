import { Router, type IRouter } from "express";
import healthRouter from "./health";
import cotRouter from "./cot";
import cotScreenerRouter from "./cot-screener";
import cotUpdateStatusRouter from "./cot-update-status";

const router: IRouter = Router();

router.use(healthRouter);
router.use(cotRouter);
router.use(cotScreenerRouter);
router.use(cotUpdateStatusRouter);

export default router;
