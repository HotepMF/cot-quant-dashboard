import { useEffect, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { getGetCotUpdateStatusQueryKey, useGetCotUpdateStatus } from "@workspace/api-client-react";

const et = (value: string) => new Date(value).toLocaleString("en-US", {
  timeZone: "America/New_York", month: "short", day: "numeric", hour: "numeric", minute: "2-digit",
});

export function CftcUpdateStatus() {
  const client = useQueryClient();
  const lastSuccess = useRef<string | null | undefined>(undefined);
  const { data, isError } = useGetCotUpdateStatus({
    query: {
      queryKey: getGetCotUpdateStatusQueryKey(), refetchInterval: 60_000,
      refetchOnMount: "always", refetchOnWindowFocus: true,
    },
  });
  useEffect(() => {
    if (!data) return;
    if (lastSuccess.current !== undefined && data.lastSuccessAt && data.lastSuccessAt !== lastSuccess.current) {
      void client.invalidateQueries({
        predicate: query => typeof query.queryKey[0] === "string" && /\/cot\/(markets|market|screener)$/.test(query.queryKey[0]),
      });
    }
    lastSuccess.current = data.lastSuccessAt;
  }, [client, data?.lastSuccessAt]);
  const warning = isError || Boolean(data?.lastError);
  return <small data-testid="status-auto-update" role={warning ? "alert" : undefined} style={{ display: "block", marginTop: 6, lineHeight: 1.6, ...(warning ? { color: "#e6a752" } : {}) }}>
    {isError ? "Automatic update status unavailable; checking again shortly."
      : data?.lastError ? data.lastError
        : data?.running ? "Automatic updater is fetching and saving official CFTC data."
          : <>Server auto-updates · Fridays from 3:30 p.m. ET · delayed releases retry automatically.</>}
    {data?.nextCheckAt && !data.running ? ` Next check ${et(data.nextCheckAt)} ET.` : ""}
    {data?.waitingForRelease && !data.running && !data.lastError ? " Waiting for the next official release." : ""}
  </small>;
}
