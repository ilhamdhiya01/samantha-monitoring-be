import { Controller, Get } from '@nestjs/common';
import { ResponseMessage } from '../../common/decorators/response-message.decorator';
import { ContainersService, toContainerDtos } from './containers.service';
import type { ContainerDto } from './dto/container.dto';

@Controller('containers')
export class ContainersController {
  constructor(private readonly containersService: ContainersService) {}

  @Get()
  @ResponseMessage('Daftar container')
  async list(): Promise<ContainerDto[]> {
    return toContainerDtos(await this.containersService.getAll());
  }
}
