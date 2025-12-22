import { inject, injectable } from "inversify";
import { Logger } from "@aws-lambda-powertools/logger";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient,
  PutCommand,
  GetCommand,
  QueryCommand,
  UpdateCommand,
} from "@aws-sdk/lib-dynamodb";

export type AppointmentStatus = "scheduled" | "cancelled" | "rescheduled";

export type AppointmentRecord = {
  PK: string;
  SK: string;
  tenantId: string;
  appointmentId: string;
  userId: string;
  patientName: string;
  patientPhone?: string;
  patientEmail?: string;
  doctorId: string;
  doctorName?: string;
  startIso: string;
  endIso: string;
  StartKey: string;
  UserKey: string;
  DoctorKey: string;
  StatusKey: string;
  status: AppointmentStatus;
  durationMinutes?: number;
  source?: string;
  notes?: string;
  calendarEventId?: string;
  calendarSyncStatus?: string;
  createdAt: string;
  updatedAt: string;
};

export type CreateAppointmentInput = {
  tenantId: string;
  appointmentId: string;
  userId: string;
  patientName: string;
  patientPhone?: string;
  patientEmail?: string;
  doctorId: string;
  doctorName?: string;
  startIso: string;
  endIso: string;
  durationMinutes?: number;
  source?: string;
  notes?: string;
  calendarEventId?: string;
  calendarSyncStatus?: string;
};

export type UpdateScheduleInput = {
  tenantId: string;
  appointmentId: string;
  startIso: string;
  endIso: string;
  durationMinutes?: number;
  doctorId?: string;
  doctorName?: string;
  notes?: string;
};

@injectable()
export class AppointmentsRepository {
  private readonly tableName = process.env.APPOINTMENTS_TABLE_NAME;
  private readonly userIndex = process.env.APPOINTMENTS_GSI_USER;
  private readonly doctorIndex = process.env.APPOINTMENTS_GSI_DOCTOR;
  private readonly statusIndex = process.env.APPOINTMENTS_GSI_STATUS;
  private readonly client = DynamoDBDocumentClient.from(new DynamoDBClient({}));

  constructor(@inject(Logger) private readonly log: Logger) {
    if (!this.tableName) {
      throw new Error("APPOINTMENTS_TABLE_NAME env is required");
    }
  }

  async createAppointment(input: CreateAppointmentInput): Promise<AppointmentRecord> {
    const now = new Date().toISOString();
    const item: AppointmentRecord = {
      PK: this.buildPk(input.tenantId),
      SK: this.buildSk(input.appointmentId),
      tenantId: input.tenantId,
      appointmentId: input.appointmentId,
      userId: input.userId,
      patientName: input.patientName,
      patientPhone: input.patientPhone,
      patientEmail: input.patientEmail,
      doctorId: input.doctorId,
      doctorName: input.doctorName,
      startIso: input.startIso,
      endIso: input.endIso,
      StartKey: this.buildStartKey(input.startIso),
      UserKey: this.buildUserKey(input.tenantId, input.userId),
      DoctorKey: this.buildDoctorKey(input.tenantId, input.doctorId),
      StatusKey: this.buildStatusKey(input.tenantId, "scheduled"),
      status: "scheduled",
      durationMinutes: input.durationMinutes,
      source: input.source,
      notes: input.notes,
      calendarEventId: input.calendarEventId,
      calendarSyncStatus: input.calendarSyncStatus ?? "pending",
      createdAt: now,
      updatedAt: now,
    };

    await this.client.send(
      new PutCommand({
        TableName: this.tableName,
        Item: item,
        ConditionExpression: "attribute_not_exists(PK) AND attribute_not_exists(SK)",
      })
    );

    this.log.info("repo.appointments.create", {
      tenantId: input.tenantId,
      appointmentId: input.appointmentId,
    });

    return item;
  }

  async getByAppointmentId(
    tenantId: string,
    appointmentId: string
  ): Promise<AppointmentRecord | null> {
    const res = await this.client.send(
      new GetCommand({
        TableName: this.tableName,
        Key: {
          PK: this.buildPk(tenantId),
          SK: this.buildSk(appointmentId),
        },
      })
    );

    const found = res.Item ? (res.Item as AppointmentRecord) : null;
    this.log.info("repo.appointments.getById", {
      tenantId,
      appointmentId,
      found: !!found,
    });
    return found;
  }

  async getByLookup(
    tenantId: string,
    userId: string,
    startIso: string
  ): Promise<AppointmentRecord | null> {
    if (!this.userIndex) {
      throw new Error("APPOINTMENTS_GSI_USER env is required");
    }

    const res = await this.client.send(
      new QueryCommand({
        TableName: this.tableName,
        IndexName: this.userIndex,
        KeyConditionExpression: "#uk = :uk AND #sk = :sk",
        ExpressionAttributeNames: {
          "#uk": "UserKey",
          "#sk": "StartKey",
        },
        ExpressionAttributeValues: {
          ":uk": this.buildUserKey(tenantId, userId),
          ":sk": this.buildStartKey(startIso),
        },
        Limit: 1,
      })
    );

    const found = res.Items?.[0] ? (res.Items[0] as AppointmentRecord) : null;
    this.log.info("repo.appointments.lookup", {
      tenantId,
      userId,
      startIso,
      found: !!found,
    });
    return found;
  }

  async listDoctorAppointmentsForDay(
    tenantId: string,
    doctorId: string,
    dayIso: string
  ): Promise<AppointmentRecord[]> {
    if (!this.doctorIndex) {
      throw new Error("APPOINTMENTS_GSI_DOCTOR env is required");
    }

    const bounds = this.buildDayBounds(dayIso);
    const res = await this.client.send(
      new QueryCommand({
        TableName: this.tableName,
        IndexName: this.doctorIndex,
        KeyConditionExpression: "#dk = :dk AND #sk BETWEEN :start AND :end",
        ExpressionAttributeNames: {
          "#dk": "DoctorKey",
          "#sk": "StartKey",
        },
        ExpressionAttributeValues: {
          ":dk": this.buildDoctorKey(tenantId, doctorId),
          ":start": bounds.start,
          ":end": bounds.end,
        },
      })
    );

    const items = (res.Items ?? []) as AppointmentRecord[];
    console.log("[AppointmentsRepository] Loaded doctor day view", {
      tenantId,
      doctorId,
      dayIso,
      count: items.length,
    });
    this.log.info("repo.appointments.doctorDay", {
      tenantId,
      doctorId,
      dayIso,
      count: items.length,
    });
    return items;
  }

  async listDoctorAppointmentsInRange(
    tenantId: string,
    doctorId: string,
    fromIso: string,
    toIso: string
  ): Promise<AppointmentRecord[]> {
    if (!this.doctorIndex) {
      throw new Error("APPOINTMENTS_GSI_DOCTOR env is required");
    }

    const { startKey, endKey } = this.buildRangeKeys(fromIso, toIso);

    const res = await this.client.send(
      new QueryCommand({
        TableName: this.tableName,
        IndexName: this.doctorIndex,
        KeyConditionExpression: "#dk = :dk AND #sk BETWEEN :start AND :end",
        ExpressionAttributeNames: {
          "#dk": "DoctorKey",
          "#sk": "StartKey",
        },
        ExpressionAttributeValues: {
          ":dk": this.buildDoctorKey(tenantId, doctorId),
          ":start": startKey,
          ":end": endKey,
        },
      })
    );

    const items = (res.Items ?? []) as AppointmentRecord[];
    this.log.info("repo.appointments.doctorRange", {
      tenantId,
      doctorId,
      fromIso,
      toIso,
      count: items.length,
    });
    return items;
  }

  async listUserAppointmentsInRange(
    tenantId: string,
    userId: string,
    fromIso: string,
    toIso: string
  ): Promise<AppointmentRecord[]> {
    if (!this.userIndex) {
      throw new Error("APPOINTMENTS_GSI_USER env is required");
    }

    const { startKey, endKey } = this.buildRangeKeys(fromIso, toIso);

    const res = await this.client.send(
      new QueryCommand({
        TableName: this.tableName,
        IndexName: this.userIndex,
        KeyConditionExpression: "#uk = :uk AND #sk BETWEEN :start AND :end",
        ExpressionAttributeNames: {
          "#uk": "UserKey",
          "#sk": "StartKey",
        },
        ExpressionAttributeValues: {
          ":uk": this.buildUserKey(tenantId, userId),
          ":start": startKey,
          ":end": endKey,
        },
      })
    );

    const items = (res.Items ?? []) as AppointmentRecord[];
    this.log.info("repo.appointments.userRange", {
      tenantId,
      userId,
      fromIso,
      toIso,
      count: items.length,
    });
    return items;
  }

  async listAppointmentsInRange(params: {
    tenantId: string;
    doctorId?: string;
    userId?: string;
    fromIso: string;
    toIso: string;
  }): Promise<AppointmentRecord[]> {
    if (params.doctorId) {
      return this.listDoctorAppointmentsInRange(
        params.tenantId,
        params.doctorId,
        params.fromIso,
        params.toIso
      );
    }

    if (params.userId) {
      return this.listUserAppointmentsInRange(
        params.tenantId,
        params.userId,
        params.fromIso,
        params.toIso
      );
    }

    throw new Error("Provide doctorId or userId for range queries");
  }

  async listTenantAppointmentsByStatus(
    tenantId: string,
    status: AppointmentStatus,
    dayIso: string
  ): Promise<AppointmentRecord[]> {
    if (!this.statusIndex) {
      throw new Error("APPOINTMENTS_GSI_STATUS env is required");
    }

    const bounds = this.buildDayBounds(dayIso);
    const res = await this.client.send(
      new QueryCommand({
        TableName: this.tableName,
        IndexName: this.statusIndex,
        KeyConditionExpression: "#statusKey = :sk AND #start BETWEEN :start AND :end",
        ExpressionAttributeNames: {
          "#statusKey": "StatusKey",
          "#start": "StartKey",
        },
        ExpressionAttributeValues: {
          ":sk": this.buildStatusKey(tenantId, status),
          ":start": bounds.start,
          ":end": bounds.end,
        },
      })
    );

    return (res.Items ?? []) as AppointmentRecord[];
  }

  async updateSchedule(input: UpdateScheduleInput): Promise<AppointmentRecord> {
    const key = {
      PK: this.buildPk(input.tenantId),
      SK: this.buildSk(input.appointmentId),
    };

    const startKey = this.buildStartKey(input.startIso);
    const doctorKey = input.doctorId
      ? this.buildDoctorKey(input.tenantId, input.doctorId)
      : undefined;

    const updateExpressions = ["#startIso = :startIso", "#endIso = :endIso", "#startKey = :startKey", "#updatedAt = :updatedAt"];
    const names: Record<string, string> = {
      "#startIso": "startIso",
      "#endIso": "endIso",
      "#startKey": "StartKey",
      "#updatedAt": "updatedAt",
    };
    const values: Record<string, any> = {
      ":startIso": input.startIso,
      ":endIso": input.endIso,
      ":startKey": startKey,
      ":updatedAt": new Date().toISOString(),
    };

    if (input.durationMinutes !== undefined) {
      updateExpressions.push("#duration = :duration");
      names["#duration"] = "durationMinutes";
      values[":duration"] = input.durationMinutes;
    }

    if (input.doctorId) {
      updateExpressions.push("#doctorId = :doctorId", "#doctorKey = :doctorKey");
      names["#doctorId"] = "doctorId";
      names["#doctorKey"] = "DoctorKey";
      values[":doctorId"] = input.doctorId;
      values[":doctorKey"] = doctorKey;
    }

    if (input.doctorName) {
      updateExpressions.push("#doctorName = :doctorName");
      names["#doctorName"] = "doctorName";
      values[":doctorName"] = input.doctorName;
    }

    if (input.notes !== undefined) {
      updateExpressions.push("#notes = :notes");
      names["#notes"] = "notes";
      values[":notes"] = input.notes;
    }

    updateExpressions.push("#calendarSyncStatus = :pendingSync");
    names["#calendarSyncStatus"] = "calendarSyncStatus";
    values[":pendingSync"] = "pending";

    const result = await this.client.send(
      new UpdateCommand({
        TableName: this.tableName,
        Key: key,
        UpdateExpression: `SET ${updateExpressions.join(", ")}`,
        ExpressionAttributeNames: names,
        ExpressionAttributeValues: values,
        ConditionExpression: "attribute_exists(PK)",
        ReturnValues: "ALL_NEW",
      })
    );

    this.log.info("repo.appointments.schedule.updated", {
      tenantId: input.tenantId,
      appointmentId: input.appointmentId,
      startIso: input.startIso,
      endIso: input.endIso,
      doctorId: input.doctorId,
    });
    return result.Attributes as AppointmentRecord;
  }

  async updateStatus(
    tenantId: string,
    appointmentId: string,
    status: AppointmentStatus
  ): Promise<AppointmentRecord> {
    const key = {
      PK: this.buildPk(tenantId),
      SK: this.buildSk(appointmentId),
    };

    const result = await this.client.send(
      new UpdateCommand({
        TableName: this.tableName,
        Key: key,
        UpdateExpression:
          "SET #status = :status, #statusKey = :statusKey, #updatedAt = :updatedAt, #calendarSyncStatus = :pending",
        ExpressionAttributeNames: {
          "#status": "status",
          "#statusKey": "StatusKey",
          "#updatedAt": "updatedAt",
          "#calendarSyncStatus": "calendarSyncStatus",
        },
        ExpressionAttributeValues: {
          ":status": status,
          ":statusKey": this.buildStatusKey(tenantId, status),
          ":updatedAt": new Date().toISOString(),
          ":pending": "pending",
        },
        ConditionExpression: "attribute_exists(PK)",
        ReturnValues: "ALL_NEW",
      })
    );

    this.log.info("repo.appointments.status.updated", {
      tenantId,
      appointmentId,
      status,
    });
    return result.Attributes as AppointmentRecord;
  }

  private buildPk(tenantId: string) {
    return `TENANT#${tenantId}`;
  }

  private buildSk(appointmentId: string) {
    return `APPT#${appointmentId}`;
  }

  private buildUserKey(tenantId: string, userId: string) {
    return `USER#${tenantId}#${userId}`;
  }

  private buildDoctorKey(tenantId: string, doctorId: string) {
    return `DOCTOR#${tenantId}#${doctorId}`;
  }

  private buildStatusKey(tenantId: string, status: AppointmentStatus) {
    return `STATUS#${tenantId}#${status}`;
  }

  private buildStartKey(iso: string): string {
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) {
      throw new Error(`Invalid ISO date: ${iso}`);
    }
    const y = date.getUTCFullYear().toString().padStart(4, "0");
    const m = (date.getUTCMonth() + 1).toString().padStart(2, "0");
    const d = date.getUTCDate().toString().padStart(2, "0");
    const hh = date.getUTCHours().toString().padStart(2, "0");
    const mm = date.getUTCMinutes().toString().padStart(2, "0");
    return `START#${y}${m}${d}#${hh}${mm}`;
  }

  private buildDayBounds(iso: string): { start: string; end: string } {
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) {
      throw new Error(`Invalid ISO date: ${iso}`);
    }
    const y = date.getUTCFullYear().toString().padStart(4, "0");
    const m = (date.getUTCMonth() + 1).toString().padStart(2, "0");
    const d = date.getUTCDate().toString().padStart(2, "0");
    const base = `START#${y}${m}${d}`;
    return { start: `${base}#0000`, end: `${base}#2359` };
  }

  private buildRangeKeys(fromIso: string, toIso: string) {
    const startKey = this.buildStartKey(fromIso);
    const endKey = this.buildStartKey(toIso);
    if (startKey > endKey) {
      throw new Error("fromIso must be before toIso");
    }
    return { startKey, endKey };
  }
}
