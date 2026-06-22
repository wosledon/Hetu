using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Hetu.Infrastructure.Data.Migrations
{
    /// <inheritdoc />
    public partial class AddScheduledTasks : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "ScheduledTaskExecutions",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "TEXT", nullable: false),
                    ScheduledTaskId = table.Column<Guid>(type: "TEXT", nullable: false),
                    StartedAt = table.Column<DateTimeOffset>(type: "TEXT", nullable: false),
                    CompletedAt = table.Column<DateTimeOffset>(type: "TEXT", nullable: true),
                    Status = table.Column<string>(type: "TEXT", maxLength: 20, nullable: false),
                    ErrorMessage = table.Column<string>(type: "TEXT", maxLength: 2000, nullable: true),
                    Result = table.Column<string>(type: "TEXT", maxLength: 2000, nullable: true),
                    RetryAttempt = table.Column<int>(type: "INTEGER", nullable: false),
                    IsManual = table.Column<bool>(type: "INTEGER", nullable: false),
                    CreatedAt = table.Column<DateTimeOffset>(type: "TEXT", nullable: false),
                    UpdatedAt = table.Column<DateTimeOffset>(type: "TEXT", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_ScheduledTaskExecutions", x => x.Id);
                });

            migrationBuilder.CreateTable(
                name: "ScheduledTasks",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "TEXT", nullable: false),
                    Name = table.Column<string>(type: "TEXT", maxLength: 200, nullable: false),
                    Description = table.Column<string>(type: "TEXT", maxLength: 1000, nullable: true),
                    TaskKind = table.Column<string>(type: "TEXT", maxLength: 50, nullable: false),
                    TargetId = table.Column<string>(type: "TEXT", maxLength: 100, nullable: true),
                    TargetName = table.Column<string>(type: "TEXT", maxLength: 500, nullable: true),
                    Parameters = table.Column<string>(type: "TEXT", nullable: true),
                    ScheduleType = table.Column<string>(type: "TEXT", maxLength: 20, nullable: false),
                    IntervalMinutes = table.Column<int>(type: "INTEGER", nullable: false),
                    CronExpression = table.Column<string>(type: "TEXT", maxLength: 200, nullable: true),
                    IsEnabled = table.Column<bool>(type: "INTEGER", nullable: false),
                    NextRunAt = table.Column<DateTimeOffset>(type: "TEXT", nullable: true),
                    LastRunAt = table.Column<DateTimeOffset>(type: "TEXT", nullable: true),
                    LastStatus = table.Column<string>(type: "TEXT", maxLength: 20, nullable: true),
                    LastError = table.Column<string>(type: "TEXT", maxLength: 2000, nullable: true),
                    MaxRetries = table.Column<int>(type: "INTEGER", nullable: false),
                    RetryCount = table.Column<int>(type: "INTEGER", nullable: false),
                    IsDeleted = table.Column<bool>(type: "INTEGER", nullable: false),
                    CreatedAt = table.Column<DateTimeOffset>(type: "TEXT", nullable: false),
                    UpdatedAt = table.Column<DateTimeOffset>(type: "TEXT", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_ScheduledTasks", x => x.Id);
                });

            migrationBuilder.CreateIndex(
                name: "IX_ScheduledTaskExecutions_ScheduledTaskId",
                table: "ScheduledTaskExecutions",
                column: "ScheduledTaskId");

            migrationBuilder.CreateIndex(
                name: "IX_ScheduledTaskExecutions_StartedAt",
                table: "ScheduledTaskExecutions",
                column: "StartedAt");

            migrationBuilder.CreateIndex(
                name: "IX_ScheduledTasks_IsDeleted",
                table: "ScheduledTasks",
                column: "IsDeleted");

            migrationBuilder.CreateIndex(
                name: "IX_ScheduledTasks_IsEnabled",
                table: "ScheduledTasks",
                column: "IsEnabled");

            migrationBuilder.CreateIndex(
                name: "IX_ScheduledTasks_NextRunAt",
                table: "ScheduledTasks",
                column: "NextRunAt");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "ScheduledTaskExecutions");

            migrationBuilder.DropTable(
                name: "ScheduledTasks");
        }
    }
}
