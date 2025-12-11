type CounterMap = Record<string, number>;

const counters: CounterMap = {};
const events: Array<{ at: number; name: string; meta?: unknown }> = [];

export const metrics = {
  inc: (name: string, meta?: unknown) => {
    counters[name] = (counters[name] || 0) + 1;
    events.push({ at: Date.now(), name, meta });
    if (events.length > 10000) events.shift();
  },
  snapshot: () => ({ counters: { ...counters }, recent: events.slice(-1000) }),
  reset: () => {
    for (const k of Object.keys(counters)) delete counters[k];
    events.splice(0, events.length);
  },
};
