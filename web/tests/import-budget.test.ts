import test from "node:test";
import assert from "node:assert/strict";
import { ImportBudget, positiveLimit } from "../scripts/import-budget";

test("le budget réserve avant l'appel et refuse tout dépassement",()=>{
  const b=new ImportBudget(2,6);
  b.reserve(["é"]); // two UTF-8 bytes
  assert.equal(b.bytes,2);
  assert.throws(()=>b.reserve(["12345"]));
  assert.equal(b.calls,1);
  b.reserve(["1234"]);
  assert.equal(b.bytes,6);
  assert.throws(()=>b.reserve([""]));
});
test("les plafonds invalides ne désactivent pas la protection",()=>{
  for(const v of ["0","-1","NaN","Infinity","1.5",""]) assert.throws(()=>positiveLimit(v,25));
  assert.equal(positiveLimit(undefined,25),25);
  assert.equal(positiveLimit("10",25),10);
});
