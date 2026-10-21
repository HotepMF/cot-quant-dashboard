import { Router, type IRouter } from "express";
import { getCftcUpdateStatus } from "../services/cot-updater";

const router: IRouter = Router();
router.get("/cot/update-status", async (req, res) => {
  try {
    res.setHeader("Cache-Control", "no-store");
    res.json(await getCftcUpdateStatus());
  } catch (error) {
    req.log.error({ err: error }, "CFTC automatic-update status unavailable");
    res.status(503).json({ message: "Automatic update status is temporarily unavailable." });
  }
});
export default router;
