import { run, bench } from 'mitata';

// 객체를 실제로 소비하여 DCE 방지용 사이드 이펙트 생성
let sink: any;

function createDynamic(v1, v2) {
  const p = Object.create(null);
  p.year = v1;
  p.month = v2;
  return p;
}

function BlankCtor() {
  this.year = undefined;
  this.month = undefined;
}
function createGeminiBlank(v1, v2) {
  const p = new BlankCtor();
  p.year = v1;
  p.month = v2;
  return p;
}

function ArgsCtor(v1, v2) {
  this.year = v1;
  this.month = v2;
}
function createReviewerCtor(v1, v2) {
  return new ArgsCtor(v1, v2);
}

function createReviewerLiteral(v1, v2) {
  return { year: v1, month: v2 };
}

const p1 = '2023';
const p2 = '10';

bench('1. Current (Dynamic Object.create)', () => { sink = createDynamic(p1, p2); });
bench('2. Gemini (Blank Ctor + Reassign)', () => { sink = createGeminiBlank(p1, p2); });
bench('3. Reviewer (Args Ctor)', () => { sink = createReviewerCtor(p1, p2); });
bench('4. Reviewer (Object Literal)', () => { sink = createReviewerLiteral(p1, p2); });

await run();
