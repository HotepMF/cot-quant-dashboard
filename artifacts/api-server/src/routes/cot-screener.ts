import { Router, type IRouter } from "express";
import { getReportKey } from "./cot";
import { ensureScan, parseSignalSettings, scanResponse } from "../services/cot-screener";

const router: IRouter = Router();

router.get("/cot/screener", async (req, res) => {
  const report = getReportKey(req.query.report);
  if (!report) { res.status(400).json({ message: "Choose futures or combined." }); return; }
  let settings;
  try { settings = parseSignalSettings(req.query); }
  catch (error) { res.status(400).json({ message: error instanceof Error ? error.message : "Invalid settings." }); return; }
  try {
    const scan = await ensureScan(report);
    res.setHeader("Cache-Control", "no-store");
    res.json(scanResponse(scan, settings));
  } catch (error) {
    req.log.warn({ error: error instanceof Error ? error.message : "Unknown source error" }, "CFTC screener request failed");
    res.status(502).json({ message: error instanceof Error ? error.message : "CFTC source unavailable." });
  }
});

router.post("/cot/screener/refresh", async (req, res) => {
  const report = getReportKey(req.body?.report);
  if (!report) { res.status(400).json({ message: "Choose futures or combined." }); return; }
  try {
    const scan = await ensureScan(report, true);
    res.setHeader("Cache-Control", "no-store");
    res.json({ status: scan.status, startedAt: scan.startedAt });
  } catch (error) {
    res.status(502).json({ message: error instanceof Error ? error.message : "CFTC source unavailable." });
  }
});

export default router;
