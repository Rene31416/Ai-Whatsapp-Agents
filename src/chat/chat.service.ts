import { inject, injectable } from "inversify";
import { DentalWorkflow } from "./dental.workflow";
import { State } from "./models";

@injectable()
export class ChatService {
  constructor(
    @inject(DentalWorkflow)
    private readonly dentalWorkflow: DentalWorkflow
  ) {}

  async run(message: string, history: any[]): Promise<State> {
    const start = Date.now();
    console.log("🪄 ChatService.run() invoked");
    const result = await this.dentalWorkflow.run(message, history);
    console.log(`✅ Workflow done in ${Date.now() - start} ms`);
    console.log("✅ Workflow result:", result);
    return result;
  }
}
