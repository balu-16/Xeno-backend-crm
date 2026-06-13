import { Injectable } from "@nestjs/common";
import { Observable, Subject } from "rxjs";
import { filter, map } from "rxjs/operators";

type StreamEvent = {
  channel: "analytics" | "monitor";
  data: unknown;
};

@Injectable()
export class AppEventsService {
  private readonly events = new Subject<StreamEvent>();

  stream(channel: StreamEvent["channel"]): Observable<unknown> {
    return this.events.pipe(
      filter((event) => event.channel === channel),
      map((event) => event.data)
    );
  }

  publish(channel: StreamEvent["channel"], data: unknown): void {
    this.events.next({ channel, data });
  }
}
