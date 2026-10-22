import BenkeiHome from "@/components/benkei-home";

export default function BenkeiPage() {
  return <main style={{ width: "min(100%, 960px)", margin: "0 auto", padding: "24px 16px" }}>
    <h1>ベンケイの確認</h1>
    <BenkeiHome fullPage />
  </main>;
}
