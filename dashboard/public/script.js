async function loadStats() {
  const res = await fetch("/api/stats");
  const data = await res.json();
  document.getElementById("pending").innerText = data.pending;
  document.getElementById("processing").innerText = data.processing;
  document.getElementById("completed").innerText = data.completed;
  document.getElementById("dead").innerText = data.dead;
}

async function loadJobs() {
  const res = await fetch("/api/jobs");
  const jobs = await res.json();
  const tbody = document.querySelector("#jobsTable tbody");
  tbody.innerHTML = "";

  jobs.forEach(job => {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${job.id}</td>
      <td>${job.command}</td>
      <td>${job.state}</td>
      <td>${job.attempts}</td>
      <td>
        ${job.state === "dead"
          ? `<button onclick="retryJob('${job.id}')">Retry</button>`
          : "-"
        }
      </td>
    `;
    tbody.appendChild(tr);
  });
}

async function retryJob(id) {
  await fetch(`/api/dlq/retry/${id}`, { method: "POST" });
  loadStats();
  loadJobs();
}

setInterval(() => {
  loadStats();
  loadJobs();
}, 2000);

loadStats();
loadJobs();
