import "reflect-metadata";
import { ApiLambdaApp, AppConfig } from "ts-lambda-api";
import * as path from "path";
import { container } from "./container";
import type { ApiRequest } from "ts-lambda-api";
import "../controller/chat.controller";

// 🧩 1. Reuse same controller structure as Lambda
const appConfig = new AppConfig();
const controllersPath = [path.join(__dirname, "../controller")];

// 🧩 2. Initialize the same ApiLambdaApp locally
const app = new ApiLambdaApp(controllersPath, appConfig, false, container);

// 🧠 3. Local interactive test session
async function main() {
  console.log("🚀 Starting local Chat API (ts-lambda-api)...");
  console.log("Type messages to simulate POST /chat requests.\n");

  while (true) {
    const messageText = await new Promise<string>((resolve) => {
      process.stdout.write("WhatsApp (enter q to exit): ");
      process.stdin.once("data", (data) => resolve(data.toString().trim()));
    });

    if (messageText.toLowerCase() === "q") {
      console.log("👋 Exiting local chat test.");
      break;
    }

    // 📨 Simulate API Gateway event for /chat POST

    // 📨 Simulate an API Gateway event for /chat POST
    const fakeEvent: ApiRequest = {
      httpMethod: "POST",
      path: "/chat",
      headers: {
        "content-type": "application/json",
      },
      queryStringParameters: {},
      body: JSON.stringify({
        message: messageText,
        history: [],
      }),
      isBase64Encoded: false,
    };

    const fakeContext = {}; // minimal mock
    const response = await app.run(fakeEvent, fakeContext);

    console.log("\n--- API Response ---");
    console.log(response.body);
    console.log("--------------------\n");
  }

  process.exit(0);
}

main().catch((err) => {
  console.error("❌ Fatal error:", err);
  process.exit(1);
});
