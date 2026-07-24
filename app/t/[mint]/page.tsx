import { ReplayApp } from "@/components/ReplayApp";

export default function TokenPage({
  params,
  searchParams,
}: {
  params: { mint: string };
  searchParams: { w?: string; mock?: string; wallet?: string; chain?: string };
}) {
  return (
    <ReplayApp
      mint={params.mint}
      windowKey={searchParams.w ?? "1h"}
      mock={searchParams.mock === "1"}
      initialFocus={searchParams.wallet}
      chain={searchParams.chain}
    />
  );
}
