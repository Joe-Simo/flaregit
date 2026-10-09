import {expect, test} from "bun:test";
import {certify, REQUIRED_EVIDENCE_KINDS, type CertificationEvidence} from "../src/core/parity-certification";

const certifyAtSource = (tickets: Parameters<typeof certify>[0]) => certify(tickets, sourceRevision);
const sourceRevision = "b".repeat(40);
const evidence = (): CertificationEvidence[] => REQUIRED_EVIDENCE_KINDS.map(kind => ({kind, ticketId: "F01", sourceRevision, reference: `receipts/F01/${kind}.json`, sha256: "a".repeat(64), outcome: "passed"}));

test("a declared ticket needs passing digest-bound receipts for every required evidence kind", () => {
  expect(certifyAtSource([{id: "F01", evidence: evidence()}])).toEqual({complete: true, gaps: [], errors: []});
  expect(certifyAtSource([{id: "F01", evidence: evidence().slice(1)}, {id: "F02", evidence: []}]).gaps).toEqual(["F01", "F02"]);
  for (const outcome of ["failed", "blocked"] as const) {
    expect(certifyAtSource([{id: "F01", evidence: evidence().map(receipt => ({...receipt, outcome}))}]).complete).toBe(false);
  }
});

test("empty catalogs, duplicate and invalid ticket ids never certify", () => {
  expect(certifyAtSource([]).complete).toBe(false);
  expect(certifyAtSource([{id: "F01", evidence: evidence()}, {id: "F01", evidence: evidence()}])).toEqual({complete: false, gaps: ["F01"], errors: ["Duplicate ticket id: F01"]});
  expect(certifyAtSource([{id: " ", evidence: evidence()}]).complete).toBe(false);
});

test("unsafe or unbound receipt references cannot close a ticket", () => {
  for (const reference of ["", "receipt ", "../receipt.json", "/receipt.json", "file:///receipt.json", "https://example.com/", "https://user:secret@example.com/receipt.json", "https://example.com/receipt.json?token=secret", "https://example.com/receipt.json#part"]) {
    expect(certifyAtSource([{id: "F01", evidence: evidence().map(receipt => ({...receipt, reference}))}]).complete).toBe(false);
  }
  expect(certifyAtSource([{id: "F01", evidence: evidence().map(receipt => ({...receipt, sha256: "receipt"}))}]).complete).toBe(false);
  expect(certifyAtSource([{id: "F01", evidence: evidence().map(receipt => ({...receipt, reference: "https://example.com/receipts/passed.json"}))}]).complete).toBe(true);
});


test("receipts must belong to the certified ticket and exact expected source", () => {
  expect(certify([{id: "F01", evidence: evidence()}], "").complete).toBe(false);
  expect(certifyAtSource([{id: "F02", evidence: evidence()}]).gaps).toEqual(["F02"]);
  expect(certify([{id: "F01", evidence: evidence()}], "c".repeat(40)).complete).toBe(false);
  expect(certifyAtSource([{id: "F01", evidence: evidence().map(receipt => ({...receipt, sourceRevision: "c".repeat(40)}))}]).complete).toBe(false);
});
