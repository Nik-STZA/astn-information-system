// Route binding only. The page itself lives in the Finance module so the
// module stays self-contained and liftable.
export { default } from "@/modules/finance/pages/CostsPage";
export const dynamic = "force-dynamic";
