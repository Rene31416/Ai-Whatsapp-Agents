import { webhookContainer } from "../containers/webhook.container";
import { ApiLambdaApp, AppConfig } from "ts-lambda-api";
import * as path from "path"
import "../../controller/chat.controller";

const appConfig = new AppConfig();

const controllersPath = [path.join(__dirname, "../controller")];

const app = new ApiLambdaApp(controllersPath, appConfig, false, webhookContainer);

export async function handler(event: any, context: any) {
  console.log("Event:", JSON.stringify(event, null, 2));

  const response = await app.run(event, context)
    return response

}
