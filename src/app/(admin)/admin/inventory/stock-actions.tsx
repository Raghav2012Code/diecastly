import { AdjustDialog } from "./adjust-dialog";
import { MovementHistoryButton } from "./movement-history";
import { OpeningStockDialog } from "./opening-stock-dialog";
import { RestockDialog } from "./restock-dialog";

export function StockActions({
  productId,
  productName,
  currentQuantity,
  currentCost,
  hasInitialStock,
}: {
  productId: string;
  productName: string;
  currentQuantity: number;
  currentCost: number | null;
  hasInitialStock: boolean;
}) {
  return (
    <div className="flex items-center justify-end gap-1">
      {!hasInitialStock ? (
        <OpeningStockDialog productId={productId} productName={productName} unitCost={currentCost} />
      ) : null}
      <RestockDialog productId={productId} productName={productName} currentCost={currentCost} />
      <AdjustDialog productId={productId} productName={productName} currentQuantity={currentQuantity} />
      <MovementHistoryButton productId={productId} productName={productName} />
    </div>
  );
}
