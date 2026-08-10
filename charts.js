/* ===========================================================
   PS99Charts — one auto-scaling points/hour area chart,
   styled to match the dark dashboard theme.
=========================================================== */
const PS99Charts = (() => {
  let chart = null;

  function fmtCompact(n) {
    return new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 2 }).format(n);
  }

  function fmtClock(ts) {
    return new Date(ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  }

  function render(canvas, series) {
    const ctx = canvas.getContext("2d");

    const gradient = ctx.createLinearGradient(0, 0, 0, canvas.height || 220);
    gradient.addColorStop(0, "rgba(255,93,115,0.35)");
    gradient.addColorStop(1, "rgba(255,93,115,0.02)");

    const labels = series.map((p) => fmtClock(p[0]));
    const values = series.map((p) => p[1]);

    const cfg = {
      type: "line",
      data: {
        labels,
        datasets: [{
          data: values,
          borderColor: "#ff5d73",
          backgroundColor: gradient,
          borderWidth: 2,
          fill: true,
          tension: 0.35,
          pointRadius: (c) => (c.dataIndex === values.length - 1 ? 4 : 0),
          pointBackgroundColor: "#ff5d73",
          pointBorderColor: "#08090b",
          pointBorderWidth: 2,
        }],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: { duration: 400 },
        interaction: { mode: "index", intersect: false },
        plugins: {
          legend: { display: false },
          tooltip: {
            backgroundColor: "#131519",
            borderColor: "#23262d",
            borderWidth: 1,
            titleColor: "#8a8f9a",
            bodyColor: "#edeff2",
            bodyFont: { family: "JetBrains Mono" },
            padding: 10,
            callbacks: { label: (c) => fmtCompact(c.parsed.y) + " pts" },
          },
        },
        scales: {
          x: {
            grid: { display: false },
            ticks: { color: "#565a63", maxTicksLimit: 6, font: { size: 10 } },
          },
          y: {
            grid: { color: "#1a1c22" },
            ticks: { color: "#565a63", font: { size: 10, family: "JetBrains Mono" }, callback: (v) => fmtCompact(v) },
          },
        },
      },
    };

    if (chart) { chart.destroy(); }
    chart = new Chart(ctx, cfg);
    return chart;
  }

  return { render };
})();
