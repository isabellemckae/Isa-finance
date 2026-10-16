import { SectionTabs } from "@/components/layout/section-tabs";

const TABS = [
  { href: "/cfo", label: "Chat" },
  { href: "/cfo/briefing", label: "Briefing" },
];

export default function CfoLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="space-y-5">
      <SectionTabs items={TABS} label="Personal CFO sections" />
      {children}
    </div>
  );
}
