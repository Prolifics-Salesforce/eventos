const paths: Record<string, React.ReactNode> = {
  today: <><circle cx="10" cy="10" r="3.2" /><path d="M10 2.5v2M10 15.5v2M2.5 10h2M15.5 10h2M4.7 4.7l1.4 1.4M13.9 13.9l1.4 1.4M4.7 15.3l1.4-1.4M13.9 6.1l1.4-1.4" /></>,
  events: <><rect x="3" y="4.5" width="14" height="12.5" rx="2.5" /><path d="M3 8.5h14M7 2.5v3.5M13 2.5v3.5" /></>,
  inbox: <><path d="M3 11.5 5.2 4.6A1.5 1.5 0 0 1 6.6 3.5h6.8a1.5 1.5 0 0 1 1.4 1.1L17 11.5v3.5a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 3 15z" /><path d="M3 11.5h4l1 2h4l1-2h4" /></>,
  runs: <path d="M2.5 10h3l2-5.5 3.5 11 2.5-7.5 1 2h3" />,
  agents: <><path d="M4 14.5a7 7 0 1 1 12 0" /><path d="M10 11.5 13.5 6" /><circle cx="10" cy="11.8" r="1.4" /></>,
  team: <><circle cx="7.3" cy="7" r="2.8" /><path d="M2.5 16.5c.4-2.7 2.3-4.3 4.8-4.3s4.4 1.6 4.8 4.3" /><path d="M13 4.6a2.6 2.6 0 0 1 0 5M14.3 12.4c1.7.5 2.9 1.9 3.2 4.1" /></>,
  insights: <path d="M3.5 16.5V9.5M8 16.5v-12M12.5 16.5v-6M17 16.5V7" />,
  settings: <><circle cx="7" cy="6" r="2" /><circle cx="13" cy="14" r="2" /><path d="M3 6h2M9 6h8M3 14h8M15 14h2" /></>,
  activity: <path d="M3.5 5h13M3.5 10h13M3.5 15h8" />,
};

export function Icon({ name }: { name: keyof typeof paths | string }) {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {paths[name]}
    </svg>
  );
}
