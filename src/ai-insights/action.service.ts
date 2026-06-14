import {
  Injectable,
  Logger,
  NotFoundException,
  ConflictException,
} from "@nestjs/common";
import { InsightActionStatus, InsightActionType } from "@prisma/client";
import { toInputJson } from "../common/json";
import { PrismaService } from "../prisma/prisma.service";
import { SegmentCompilerService } from "../segments/segment-compiler.service";

@Injectable()
export class ActionService {
  private readonly logger = new Logger(ActionService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly segmentCompiler: SegmentCompilerService,
  ) {}

  async createActions(
    insightId: string,
    suggestedActions: Array<{
      type: string;
      label: string;
      description?: string;
      metadata?: Record<string, unknown>;
    }>
  ) {
    const insight = await this.prisma.aIInsight.findUnique({
      where: { id: insightId },
    });
    if (!insight) {
      throw new NotFoundException("Insight not found");
    }

    const created = await this.prisma.aIInsightAction.createMany({
      data: suggestedActions.map((action) => ({
        insightId,
        type: action.type as InsightActionType,
        label: action.label,
        description: action.description ?? null,
        metadata: action.metadata ? toInputJson(action.metadata) : undefined,
      })),
    });

    this.logger.log(
      `Created ${created.count} actions for insight ${insightId}`
    );

    return this.prisma.aIInsightAction.findMany({
      where: { insightId },
      orderBy: { createdAt: "desc" },
    });
  }

  async listByInsight(insightId: string) {
    return this.prisma.aIInsightAction.findMany({
      where: { insightId },
      orderBy: { createdAt: "desc" },
    });
  }

  async markClicked(actionId: string) {
    const action = await this.prisma.aIInsightAction.findUnique({
      where: { id: actionId },
    });
    if (!action) {
      throw new NotFoundException("Action not found");
    }
    if (action.status !== InsightActionStatus.GENERATED) {
      throw new ConflictException(
        `Action is already ${action.status}, cannot mark as clicked`
      );
    }

    const updated = await this.prisma.aIInsightAction.update({
      where: { id: actionId },
      data: {
        status: InsightActionStatus.CLICKED,
        clickedAt: new Date(),
      },
    });

    this.logger.log(`Action ${actionId} marked as CLICKED`);
    return updated;
  }

  async executeAction(actionId: string, userId: string) {
    const action = await this.prisma.aIInsightAction.findUnique({
      where: { id: actionId },
      include: { insight: true },
    });
    if (!action) {
      throw new NotFoundException("Action not found");
    }
    if (
      action.status === InsightActionStatus.EXECUTED ||
      action.status === InsightActionStatus.FAILED
    ) {
      throw new ConflictException(
        `Action is already ${action.status}`
      );
    }

    let executedResult: Record<string, unknown> = {};

    try {
      switch (action.type) {
        case InsightActionType.GENERATE_SEGMENT: {
          const metadata = (action.metadata as Record<string, unknown>) ?? {};
          const rawRules = metadata.rules ?? metadata.suggestedRules;
          const validatedRules = this.segmentCompiler.validate(rawRules ?? { operator: "AND", conditions: [{ field: "orderCount", operator: ">", value: 0 }] });
          const segmentName =
            (metadata.segmentName as string) ??
            `AI Segment - ${action.label}`;
          const segment = await this.prisma.segment.create({
            data: {
              name: segmentName,
              description: `Auto-generated from insight ${action.insightId}`,
              rules: toInputJson(validatedRules),
            },
          });
          executedResult = {
            segmentId: segment.id,
            segmentName: segment.name,
          };
          this.logger.log(
            `Created segment ${segment.id} from action ${actionId}`
          );
          break;
        }
        case InsightActionType.CREATE_CAMPAIGN: {
          const metadata = (action.metadata as Record<string, unknown>) ?? {};
          const campaignName =
            (metadata.campaignName as string) ??
            `AI Campaign - ${action.label}`;
          const segmentId = metadata.segmentId as string | undefined;
          const channel = (metadata.channel as string) ?? "EMAIL";
          if (!segmentId) {
            throw new ConflictException(
              "GENERATE_SEGMENT must be executed first to create a segment"
            );
          }
          const campaign = await this.prisma.campaign.create({
            data: {
              name: campaignName,
              segmentId,
              channel: channel as any,
              subject:
                (metadata.subject as string) ??
                `AI Generated: ${action.label}`,
              message:
                (metadata.message as string) ??
                action.description ??
                "AI generated campaign message",
            },
          });
          executedResult = {
            campaignId: campaign.id,
            campaignName: campaign.name,
            status: "DRAFT",
          };
          this.logger.log(
            `Created campaign ${campaign.id} from action ${actionId}`
          );
          break;
        }
        case InsightActionType.LAUNCH_CAMPAIGN: {
          const metadata = (action.metadata as Record<string, unknown>) ?? {};
          const segmentId = metadata.segmentId as string | undefined;
          const channel = (metadata.channel as string) ?? "EMAIL";
          const campaignName =
            (metadata.campaignName as string) ??
            `AI Campaign - ${action.label}`;
          if (!segmentId) {
            throw new ConflictException(
              "Segment ID is required to launch a campaign"
            );
          }
          const campaign = await this.prisma.campaign.create({
            data: {
              name: campaignName,
              segmentId,
              channel: channel as any,
              subject:
                (metadata.subject as string) ??
                `AI Generated: ${action.label}`,
              message:
                (metadata.message as string) ??
                action.description ??
                "AI generated campaign message",
            },
          });
          executedResult = {
            campaignId: campaign.id,
            campaignName: campaign.name,
            status: "CREATED",
            launched: true,
            note: "Campaign created; use campaigns service to launch",
          };
          this.logger.log(
            `Created campaign ${campaign.id} for launch from action ${actionId}`
          );
          break;
        }
        default: {
          executedResult = {
            actionType: action.type,
            executedBy: userId,
            note: `Action type ${action.type} executed generically`,
          };
          this.logger.log(
            `Executed generic action ${actionId} of type ${action.type}`
          );
          break;
        }
      }
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      this.logger.error(
        `Failed to execute action ${actionId}: ${errorMessage}`
      );

      await this.prisma.aIInsightAction.update({
        where: { id: actionId },
        data: {
          status: InsightActionStatus.FAILED,
          executedAt: new Date(),
          executedResult: toInputJson({
            error: errorMessage,
            userId,
          }),
        },
      });

      throw error;
    }

    const updated = await this.prisma.aIInsightAction.update({
      where: { id: actionId },
      data: {
        status: InsightActionStatus.EXECUTED,
        executedAt: new Date(),
        executedResult: toInputJson(executedResult),
      },
    });

    this.logger.log(`Action ${actionId} executed successfully`);
    return updated;
  }
}
