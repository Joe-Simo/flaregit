export interface EventItem {
  id: string;
  name: string;
  venue: string;
  date: string;
  price: number; // in dollars initially: 40
}

export interface QuoteParams {
  ticketCount: number;
  basePrice: number;
  isRefundable?: boolean;
}

export interface ReceiptLineItem {
  description: string;
  amount: number;
  isDiscount?: boolean;
}

export interface QuoteResult {
  ticketCount: number;
  basePrice: number;
  ticketTotal: number;
  discountAmount: number;
  refundFeeTotal: number;
  total: number;
  isRefundable: boolean;
  breakdown: string[];
  receiptItems?: ReceiptLineItem[];
}
