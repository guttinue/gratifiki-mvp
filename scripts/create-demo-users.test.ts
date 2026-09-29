import { describe, expect, it } from "vitest";
import { readDemoUserConfig } from "./create-demo-users";

describe("readDemoUserConfig", () => {
  const localEnvironment = {
    SUPABASE_URL: "http://127.0.0.1:54321",
    SUPABASE_SERVICE_ROLE_KEY: "local-test-service-key",
    DEMO_TECHNICAL_EMAIL: "technical@example.invalid",
    DEMO_TECHNICAL_PASSWORD: "technical-password",
    DEMO_CAM_EMAIL: "cam@example.invalid",
    DEMO_CAM_PASSWORD: "cam-password",
  };

  it("accepts a parsed loopback Supabase URL", () => {
    expect(readDemoUserConfig(localEnvironment)).toEqual({
      url: "http://127.0.0.1:54321",
      serviceKey: "local-test-service-key",
      credentials: {
        technical: { email: "technical@example.invalid", password: "technical-password" },
        cam: { email: "cam@example.invalid", password: "cam-password" },
      },
    });
  });

  it("rejects a remote URL before reading the service key", () => {
    let serviceKeyWasRead = false;
    const remoteEnvironment = new Proxy(
      { ...localEnvironment, SUPABASE_URL: "https://project.supabase.co" },
      {
        get(target, property, receiver) {
          if (property === "SUPABASE_SERVICE_ROLE_KEY") serviceKeyWasRead = true;
          return Reflect.get(target, property, receiver);
        },
      },
    );

    expect(() => readDemoUserConfig(remoteEnvironment)).toThrow(/loopback/i);
    expect(serviceKeyWasRead).toBe(false);
  });

  it("rejects missing demo credentials", () => {
    const missingCredentials = { ...localEnvironment, DEMO_CAM_PASSWORD: "" };

    expect(() => readDemoUserConfig(missingCredentials)).toThrow(/DEMO_CAM_PASSWORD/);
  });
});
