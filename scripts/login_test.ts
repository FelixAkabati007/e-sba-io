async function run() {
  const csrfResp = await fetch("http://localhost:5174/api/auth/csrf", {
    method: "GET",
    headers: {},
    redirect: "manual",
  });
  const data = (await csrfResp.json()) as { token: string };
  const token = data.token;
  const cookie = csrfResp.headers.get("set-cookie") || "";
  const loginResp = await fetch("http://localhost:5174/api/auth/login", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-csrf-token": token,
      Cookie: cookie,
    },
    body: JSON.stringify({ username: "teacher_1a", password: "password123" }),
    redirect: "manual",
  });
  const data = await loginResp.json();
  console.log("Status:", loginResp.status);
  console.log("Body:", data);
}
run();
