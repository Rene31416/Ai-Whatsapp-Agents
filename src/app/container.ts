import "reflect-metadata";
import { Container } from "inversify";
import { ChatService } from "../chat/chat.service";
import { DentalWorkflow } from "../chat/dental.workflow";
import { WhatsappController } from "../controller/chat.controller";
import { ChatRepository } from "../chat/chat.repository";
import { TenantRepository } from "../chat/tenant.repository";

const container:Container = new Container();

container.bind(ChatService).toSelf();
container.bind(DentalWorkflow).toSelf();
container.bind(WhatsappController).toSelf();
container.bind(ChatRepository).toSelf()
container.bind(TenantRepository).toSelf()


export { container };
