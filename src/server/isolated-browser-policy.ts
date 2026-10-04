import {z} from "zod";
import {isGitIntegrityPolicy} from "../core/command-policy";
import {bindBrowserPolicy,type BrowserPolicy} from "./external-browser-verifier";
import {ticketBookingBrowserInventory,shippingCalculatorBrowserInventory,type ApprovedTicketBrowserPolicy} from "./trusted-fixture-browser-policies";
const digestSchema=z.string().regex(/^[a-f0-9]{64}$/);
const fixtureSchema=z.enum(["ticket-booking","shipping-calculator"]);
/** Derives only from a caller's frozen, server-authorized verification record.
 * It neither authorizes that record nor replaces mandatory native Git proof. */
export async function deriveTrustedBrowserPolicy(frozenRecord:unknown):Promise<{policy:BrowserPolicy;digest:string;coveredRequirements:string[]}>{
 if(!isGitIntegrityPolicy(frozenRecord))throw Error("Isolated browser checks require a valid Git integrity policy");
 const record=z.record(z.string(),z.unknown()).parse(frozenRecord);
 if(!("trustedBrowserFixture"in record)||!("trustedBrowserPolicyDigest"in record))throw Error("Frozen trusted browser configuration is missing");
 const fixture=fixtureSchema.parse(record.trustedBrowserFixture),expectedDigest=digestSchema.parse(record.trustedBrowserPolicyDigest);
 const approved:ApprovedTicketBrowserPolicy={};
 if(fixture==="ticket-booking"){
  for(const key of ["groupDiscountPercent","minTicketsForDiscount","refundFeePerTicket","discountAppliesToRefundFee"] as const){if(key in record){const value=record[key];if(key==="discountAppliesToRefundFee"){if(typeof value!=="boolean")throw Error("Approved ticket refund scope is malformed");approved[key]=value;}else{if(typeof value!=="number")throw Error("Approved ticket pricing field is malformed");approved[key]=value;}}}
 }
 const inventory=fixture==="ticket-booking"?ticketBookingBrowserInventory(approved):shippingCalculatorBrowserInventory();
 if(!inventory.complete||inventory.unsupportedCoverage.length||inventory.partialCoverage.length)throw Error("Trusted fixture browser coverage is incomplete");
 const bound=await bindBrowserPolicy(inventory.policy);
 if(bound.digest!==expectedDigest)throw Error("Frozen trusted browser policy digest differs");
 return{policy:bound.policy,digest:bound.digest,coveredRequirements:[...inventory.coveredRequirements]};
}
