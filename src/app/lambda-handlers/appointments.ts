import { container } from "../container";
import { ApiLambdaApp, AppConfig } from "ts-lambda-api";
import * as path from "path";
import "../../controller/appointments.controller";

const appConfig = new AppConfig();
const controllersPath = [path.join(__dirname, "../controller")];
const app = new ApiLambdaApp(controllersPath, appConfig, false, container);

export async function handler(event: any, context: any) {
  console.log("Appointments event:", JSON.stringify(event));
  return app.run(event, context);
}
